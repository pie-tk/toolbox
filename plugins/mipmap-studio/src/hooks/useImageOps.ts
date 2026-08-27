import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  batchDelete,
  batchRename,
  batchReverse,
} from "@/lib/commands";
import type { BatchResult, RenameTask } from "@/lib/types";
import { scanQueryKey } from "./useScan";
import { useDraftsStore } from "@/store/useDraftsStore";
import { useProgressStore } from "@/store/useProgressStore";
import { useSelectionStore } from "@/store/useSelectionStore";

function report(result: BatchResult, verb: string) {
  useProgressStore.getState().setLastHadFailures(result.failed.length > 0);
  if (result.applied > 0) toast.success(`已${verb} ${result.applied} 个图片`);
  if (result.failed.length > 0) {
    toast.error(`${result.failed.length} 个失败`, {
      description: result.failed.slice(0, 4).join("\n"),
    });
  }
}

export function useImageOps(dir: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: scanQueryKey(dir) });

  const rename = useMutation({
    mutationFn: (tasks: RenameTask[]) => batchRename(dir, tasks),
    onSuccess: (r) => {
      report(r, "重命名");
      useDraftsStore.getState().clear();
      invalidate();
    },
    onError: (e) => toast.error(`重命名失败：${String(e)}`),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => batchDelete(dir, ids),
    onSuccess: (r) => {
      report(r, "删除");
      useSelectionStore.getState().clearAll();
      invalidate();
    },
    onError: (e) => toast.error(`删除失败：${String(e)}`),
  });

  const reverse = useMutation({
    mutationFn: (ids: string[]) => batchReverse(dir, ids),
    onSuccess: (r) => {
      report(r, "反转");
      invalidate();
    },
    onError: (e) => toast.error(`反转失败：${String(e)}`),
  });

  return {
    rename,
    remove,
    reverse,
    /** True while any mutation is in flight (used to disable controls). */
    pending: rename.isPending || remove.isPending || reverse.isPending,
    invalidate,
  };
}
