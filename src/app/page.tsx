import RestaurantExplorer from "@/components/RestaurantExplorer";
import { resolveAMapClientConfig } from "@/lib/amapMaps";
import { loadRestaurantDataset } from "@/lib/restaurants";

export default async function Home() {
  const dataset = await loadRestaurantDataset();
  const amapConfig = resolveAMapClientConfig(process.env);

  return <RestaurantExplorer dataset={dataset} amapConfig={amapConfig} />;
}
