export interface RestaurantOffer {
  type: string;
  title: string;
  titleEn: string | null;
  price: number | null;
  originalPrice: number | null;
  discount: string | null;
  validTime: string | null;
  validTimeEn: string | null;
  earliestUsable: string | null;
  earliestUsableEn: string | null;
  imageUrl: string | null;
}

export interface RestaurantAmapLocation {
  lng: number;
  lat: number;
  formattedAddress: string | null;
  level: string | null;
  query: string | null;
  source: string | null;
  geocodedAt: string | null;
  originalLocation: {
    lng: number;
    lat: number;
  } | null;
  maxExpectedStationDistanceMeters: number | null;
}

export interface RestaurantRecord {
  id: string;
  city: string;
  cityLabel: string;
  stationName: string;
  stationKey: string;
  lineName: string | null;
  updatedAt: string | null;
  scanId: string | null;
  sourceUrl: string | null;
  name: string;
  namePinyin: string | null;
  shopUrl: string | null;
  shopId: string | null;
  imageUrl: string | null;
  address: string | null;
  addressPinyin: string | null;
  amapLocation: RestaurantAmapLocation | null;
  rating: number | null;
  reviewCount: number | null;
  avgPricePerPerson: number | null;
  area: string | null;
  category: string | null;
  rankingBadge: string | null;
  openStatus: string | null;
  openingHours: string | null;
  distanceText: string | null;
  distanceMeters: number | null;
  recommendedDishes: string[];
  offers: RestaurantOffer[];
  taocanCount: number;
  voucherCount: number;
  bestOfferPrice: number | null;
}

export interface CityRestaurantGroup {
  city: string;
  cityLabel: string;
  records: RestaurantRecord[];
}

export interface StationOption {
  key: string;
  city: string;
  cityLabel: string;
  stationName: string;
  lineName: string | null;
}

export interface RestaurantDataset {
  cities: CityRestaurantGroup[];
  stations: StationOption[];
  totalRecords: number;
  totalTaocanShops: number;
  latestUpdatedAt: string | null;
}
