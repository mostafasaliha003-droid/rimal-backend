const { pilotListFrom } = require('../services/hotelbedsPilotList');

function createHotelbedsPilotListController({ env = process.env } = {}) {
    if (!env || typeof env !== 'object') throw new TypeError('hotelbeds_pilot_list_dependencies_invalid');

    return function hotelbedsPilotListController(_req, res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        try {
            return res.status(200).json(pilotListFrom(env));
        } catch {
            return res.status(503).json({
                success: false,
                error: 'hotelbeds_pilot_list_unavailable',
                hotels: []
            });
        }
    };
}

module.exports = createHotelbedsPilotListController;