// 先导入 onnxruntime
importScripts("https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js");

// 配置 onnxruntime wasm 路径
self.ortWasmThreaded = "/ort-wasm-simd-threaded.wasm";
self.ortWasm = "/ort-wasm-simd.wasm";

let model = null;

onmessage = async(event) => {
    const input = event.data;
    const output = await run_model(input);
    postMessage(output);
}

async function run_model(input) {
    if (!model) {
        try {
            model = await ort.InferenceSession.create("/yolov8n.onnx", {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
        } catch (error) {
            console.error("Error loading model:", error);
            throw error;
        }
    }
    input = new ort.Tensor(Float32Array.from(input), [1, 3, 640, 640]);
    const outputs = await model.run({images: input});
    return outputs["output0"].data;
}