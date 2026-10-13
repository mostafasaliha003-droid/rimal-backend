function createLegacyMixedSearchController({
    ratehawkService,
    dubailinkService,
    Hotel,
    mappingService,
    formatHotelImage,
    logger
}) {
    if (!ratehawkService || typeof ratehawkService.fetchHotelsInChunks !== 'function'
        || typeof ratehawkService.validatedSearchParams !== 'function'
        || !dubailinkService || typeof dubailinkService.searchAvailability !== 'function'
        || !Hotel || typeof Hotel.findOne !== 'function'
        || !mappingService || typeof mappingService.deduplicateHotels !== 'function'
        || typeof formatHotelImage !== 'function'
        || !logger || typeof logger.info !== 'function' || typeof logger.warn !== 'function'
        || typeof logger.error !== 'function') {
        throw new TypeError('legacy_mixed_search_dependencies_invalid');
    }

    return async function legacyMixedSearchHandler(req, res) {
        logger.info('New live secure search request received');
        try {
            const criteria = ratehawkService.validatedSearchParams(req.body || {});
            const [rateHawkResult, dubaiLinkResult] = await Promise.allSettled([
                ratehawkService.fetchHotelsInChunks(criteria),
                dubailinkService.searchAvailability(criteria)
            ]);

            const rateHawkHotels = rateHawkResult.status === 'fulfilled' && rateHawkResult.value
                ? rateHawkResult.value : [];
            let dubaiLinkHotels = [];
            if (dubaiLinkResult.status === 'fulfilled' && dubaiLinkResult.value) {
                dubaiLinkHotels = Array.isArray(dubaiLinkResult.value)
                    ? dubaiLinkResult.value : (dubaiLinkResult.value.hotelList || []);
            }

            if (dubaiLinkHotels.length) {
                dubaiLinkHotels = await Promise.all(dubaiLinkHotels.map(async apiHotel => {
                    if (!apiHotel?.hotel_code) return apiHotel;
                    const dbInfo = await Hotel.findOne({ hotelId: String(apiHotel.hotel_code) });
                    const fallbackName = String(apiHotel.hotel_code) === '39619181'
                        ? 'Citymax Hotel Al Barsha'
                        : String(apiHotel.hotel_code) === '38772617'
                            ? 'Grand Excelsior Hotel'
                            : `فندق دبي المميز (${apiHotel.hotel_code})`;
                    if (dbInfo) {
                        logger.info(`✅ DB Match Found for Hotel: ${apiHotel.hotel_code}`);
                        apiHotel.hotel = dbInfo.name || fallbackName;
                        apiHotel.city = dbInfo.city || 'دبي';
                        const image = formatHotelImage(dbInfo.image);
                        apiHotel.image = image;
                        apiHotel.thumb = image;
                        apiHotel.photo = image;
                    } else {
                        logger.warn(`❌ No DB Match for Hotel: ${apiHotel.hotel_code}`);
                        apiHotel.hotel = fallbackName;
                        apiHotel.city = 'دبي';
                        apiHotel.image = '';
                        apiHotel.thumb = '';
                        apiHotel.photo = '';
                    }
                    return apiHotel;
                }));
            }

            const hotelsData = mappingService.deduplicateHotels([...rateHawkHotels, ...dubaiLinkHotels]);
            return res.status(200).json({ success: true, hotelsData });
        } catch (error) {
            if (error.ratehawkError === 'invalid_params') {
                return res.status(400).json({ success: false, error: 'INVALID_SEARCH_CRITERIA' });
            }
            logger.error('Search Error', { error: error.message });
            return res.status(500).json({ success: false, error: 'Search Failed' });
        }
    };
}

module.exports = createLegacyMixedSearchController;