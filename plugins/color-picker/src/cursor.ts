/** 吸管光标位图：Canvas 绘制 → RGBA 字节，交宿主 screen_cursor_set 替换系统光标。
 *  32×32（系统标准光标尺寸），尖端指向左下，热点在尖端。 */

export interface CursorBitmap {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
}

export function pipetteCursor(size = 32): CursorBitmap {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 Canvas 2D 上下文");
  const scale = size / 32;

  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4); // 局部 +y 转向屏幕左下 → 尖端在左下角
  ctx.scale(scale, scale);

  // 本体（局部坐标，+y 向下，尖端 (0, 14.5)）：
  // 下端锥形尖 + 中段管身 + 上端胶囊，外描白色描边保证任意背景下可见。
  const body = new Path2D();
  body.moveTo(0, 14.5);
  body.lineTo(-3.4, 8.6);
  body.lineTo(3.4, 8.6);
  body.closePath();
  body.rect(-2.8, -3.4, 5.6, 12.2);
  body.roundRect(-5, -14, 10, 11.6, 3.2);

  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3.2;
  ctx.stroke(body);
  ctx.fillStyle = "#3b4048";
  ctx.fill(body);

  // 胶囊玻璃窗
  const glass = new Path2D();
  glass.roundRect(-2.7, -11.9, 5.4, 6.6, 2);
  ctx.fillStyle = "#8fd0ff";
  ctx.fill(glass);

  const { data } = ctx.getImageData(0, 0, size, size);
  // 尖端 (0,14.5) 旋转 45° 后落在中心左下各 14.5·√2/2 处
  const off = 14.5 * Math.SQRT1_2 * scale;
  return {
    rgba: data,
    width: size,
    height: size,
    hotspotX: Math.round(size / 2 - off),
    hotspotY: Math.round(size / 2 + off),
  };
}
