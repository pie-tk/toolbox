// image-core 能力桥：由宿主的能力加载器实例化，共享给所有工具。
// ABI：输入经 tb_alloc 写入 wasm 内存；返回值从 tb_ret_ptr/len 读取（调用后立即拷贝）。
let wasm = null;

export async function init(wasmBytes) {
  if (wasm) return;
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  wasm = instance.exports;
}

function callWasm(fn, inputBytes, ...args) {
  if (!wasm) throw new Error("image-core 未初始化");
  const ptr = wasm.tb_alloc(inputBytes.length);
  new Uint8Array(wasm.memory.buffer, ptr, inputBytes.length).set(inputBytes);
  let code;
  try {
    code = wasm[fn](ptr, inputBytes.length, ...args);
  } finally {
    // 调用后 memory.buffer 可能因增长被替换，先按最新 buffer 读取返回区。
    const rptr = wasm.tb_ret_ptr();
    const rlen = wasm.tb_ret_len();
    const out = new Uint8Array(wasm.memory.buffer, rptr, rlen).slice();
    wasm.tb_free(ptr, inputBytes.length);
    if (code !== 0) {
      throw new Error(new TextDecoder().decode(out));
    }
    return out;
  }
}

/** 探测图片信息 → {width, height, format} */
export function probe(bytes) {
  return JSON.parse(new TextDecoder().decode(callWasm("tb_probe", bytes)));
}

/** 生成 PNG 缩略图（等比缩放到 maxW×maxH 内） */
export function thumbnail(bytes, maxW = 96, maxH = 96) {
  return callWasm("tb_thumbnail", bytes, maxW, maxH);
}

/** 水平镜像（按原格式重新编码） */
export function flip(bytes) {
  return callWasm("tb_flip", bytes);
}

export const FORMAT = { PNG: 0, JPEG: 1, WEBP: 2 };

/** 格式转换；quality 仅 JPEG；maxDim>0 时先等比缩放。 */
export function convert(bytes, format, quality = 90, maxDim = 0) {
  return callWasm("tb_convert", bytes, format, quality, maxDim);
}
