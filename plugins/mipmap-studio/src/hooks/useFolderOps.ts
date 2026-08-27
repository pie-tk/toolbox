import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { applyFolderTransform } from "@/lib/commands";
import type { FolderTransformKind } from "@/lib/types";
import { scanQueryKey } from "./useScan";

export function useFolderOps(dir: string) {
  const queryClient = useQueryClient();

  const apply = useMutation({
    mutationFn: (kind: FolderTransformKind) => applyFolderTransform(dir, kind),
    onSuccess: (r) => {
      if (r.renamed.length > 0) {
        toast.success(`已重命名 ${r.renamed.length} 个目录`);
      }
      if (r.skipped.length > 0) {
        toast.message(`跳过 ${r.skipped.length} 个已存在的目录`, {
          description: r.skipped.slice(0, 4).join("、"),
        });
      }
      if (r.renamed.length === 0 && r.skipped.length === 0) {
        toast.info("没有需要处理的目录");
      }
      queryClient.invalidateQueries({ queryKey: scanQueryKey(dir) });
    },
    onError: (e) => toast.error(`操作失败：${String(e)}`),
  });

  return { apply, pending: apply.isPending };
}
