import { useState } from "react";
import { FolderOpen, Layers } from "lucide-react";
import { Button } from "./ui/button";
import { pickFolder } from "@/lib/tauri";

interface TopBarProps {
  dir: string;
  onPick: (dir: string) => void;
}

export function TopBar({ dir, onPick }: TopBarProps) {
  const [picking, setPicking] = useState(false);

  async function handlePick() {
    setPicking(true);
    try {
      const picked = await pickFolder();
      if (picked) onPick(picked);
    } finally {
      setPicking(false);
    }
  }

  return (
    <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow">
          <Layers className="h-5 w-5" />
        </div>
        <div className="text-base font-semibold">Mipmap Studio</div>
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      <Button variant="outline" size="sm" onClick={handlePick} disabled={picking}>
        <FolderOpen className="h-4 w-4" />
        选择 res 目录
      </Button>

      <div
        className="ml-1 flex-1 truncate rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground"
        title={dir}
      >
        {dir || "未选择目录（也可将文件夹拖入窗口）"}
      </div>
    </header>
  );
}
