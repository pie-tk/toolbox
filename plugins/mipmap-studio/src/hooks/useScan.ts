import { useQuery } from "@tanstack/react-query";
import { scanProject } from "@/lib/commands";

export const scanQueryKey = (dir: string) => ["scan", dir] as const;

/** Load & group images for a `res/` directory. Shared by cache key across components. */
export function useScan(dir: string) {
  return useQuery({
    queryKey: scanQueryKey(dir),
    queryFn: () => scanProject(dir),
    enabled: !!dir,
    staleTime: 0,
  });
}
