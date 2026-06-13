export interface RestaurantOffer {
  type: string;
  title: string;
  price: number | null;
  originalPrice: number | null;
  discount: string | null;
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
  shopUrl: string | null;
  shopId: string | null;
  address: string | null;
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
