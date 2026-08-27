import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlipHorizontal2, PencilLine, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  listFolderTransforms,
  undoLast,
} from "@/lib/commands";
import type { FolderTransformKind } from "@/lib/types";
import { FOLDER_OP_ICONS } from "@/lib/folderOps";
import { scanQueryKey, useScan } from "@/hooks/useScan";
import { useFolderOps } from "@/hooks/useFolderOps";
import { useImageOps } from "@/hooks/useImageOps";
import { useDraftsStore } from "@/store/useDraftsStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { confirmDialog } from "@/store/useConfirmStore";

function Divider() {
  return <div className="mx-1 h-6 w-px bg-border" />;
}

export function Toolbar({ dir }: { dir: string }) {
  const ops = useImageOps(dir);
  const folderOps = useFolderOps(dir);
  const { data } = useScan(dir);
  const queryClient = useQueryClient();
  const collectTasks = useDraftsStore((s) => s.collectTasks);
  const deleteIds = useSelectionStore((s) => s.deleteIds);
  const reverseIds = useSelectionStore((s) => s.reverseIds);

  const { data: transforms = [] } = useQuery({
    queryKey: ["folder-transforms"],
    queryFn: listFolderTransforms,
    staleTime: Infinity,
  });

  const disabled = !dir || ops.pending || folderOps.pending;

  async function handleRename() {
    if (!data) return;
    const originals: Record<string, string> = {};
    data.entries.forEach((e) => {
      originals[e.id] = e.name;
    });
    const tasks = collectTasks(originals);
    if (tasks.length === 0) {
      toast.info("没有需要重命名的修改");
      return;
    }
    const ok = await confirmDialog({
      title: "批量重命名",
      description: `将重命名 ${tasks.length} 个图片（跨所有分辨率）。`,
      confirmText: "重命名",
    });
    if (ok) ops.rename.mutate(tasks);
  }

  async function handleDelete() {
    const ids = Array.from(deleteIds);
    if (ids.length === 0) {
      toast.info("请先勾选要删除的图片");
      return;
    }
    const ok = await confirmDialog({
      title: "批量删除",
      description: `确定删除 ${ids.length} 个图片（所有分辨率）？\n\n${ids
        .slice(0, 12)
        .join("、")}${ids.length > 12 ? " …" : ""}`,
      destructive: true,
      confirmText: "删除",
    });
    if (ok) ops.remove.mutate(ids);
  }

  async function handleReverse() {
    const ids = Array.from(reverseIds);
    if (ids.length === 0) {
      toast.info("请先勾选要反转的图片");
      return;
    }
    const ok = await confirmDialog({
      title: "批量反转",
      description: `将把 ${ids.length} 个图片水平镜像，生成到 *-ldrtl-* 文件夹（RTL 支持）。`,
      confirmText: "反转",
    });
    if (ok) ops.reverse.mutate(ids);
  }

  async function handleApply(kind: FolderTransformKind) {
    const info = transforms.find((t) => t.kind === kind);
    const ok = await confirmDialog({
      title: info?.label ?? "文件夹操作",
      description: info?.confirm,
      confirmText: "执行",
    });
    if (ok) folderOps.apply.mutate(kind);
  }

  async function handleUndo() {
    try {
      const result = await undoLast();
      if (result.undone) {
        toast.success(`已撤销：${result.detail}`);
        queryClient.invalidateQueries({ queryKey: scanQueryKey(dir) });
      } else {
        toast.info(result.detail);
      }
    } catch (e) {
      toast.error(`撤销失败：${String(e)}`);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={handleRename}
        disabled={disabled}
      >
        <PencilLine className="h-4 w-4" /> 批量重命名
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={handleDelete}
        disabled={disabled}
      >
        <Trash2 className="h-4 w-4" /> 批量删除
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={handleReverse}
        disabled={disabled}
      >
        <FlipHorizontal2 className="h-4 w-4" /> 批量反转
      </Button>
      <Button size="sm" variant="ghost" onClick={handleUndo} disabled={disabled}>
        <Undo2 className="h-4 w-4" /> 撤销
      </Button>

      <Divider />

      {transforms.map((t) => {
        const Icon = FOLDER_OP_ICONS[t.kind];
        return (
          <Button
            key={t.kind}
            size="sm"
            variant="outline"
            title={t.description}
            disabled={disabled}
            onClick={() => handleApply(t.kind)}
          >
            <Icon className="h-4 w-4" /> {t.label}
          </Button>
        );
      })}
    </div>
  );
}
