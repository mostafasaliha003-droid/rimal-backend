const OfferCache = require('./OfferCache');
const hotelbedsMockDatabase = require('../services/hotelbedsMockDatabase');

// Hotelbeds offer records use the same schema and collection name, but live in
// a distinct MongoDB database and connection from RateHawk's OfferCache.
module.exports = hotelbedsMockDatabase.model('HotelbedsOfferCache', OfferCache.schema);