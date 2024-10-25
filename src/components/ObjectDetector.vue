<template>
  <div class="detector-container">
    <video ref="video" style="display:none"></video>
    <canvas ref="canvas" class="detection-canvas"></canvas>
    <div class="controls">
      <button @click="startCamera">Start Camera</button>
      <button @click="stopCamera">Stop Camera</button>
    </div>
    <div class="detection-results">
      <h3>Detection Results:</h3>
      <div v-for="(result, index) in detectionResults" :key="index" class="result-item">
        {{ result.label }} {{ (result.prob * 100).toFixed(4) }}%
        x:{{ result.x1.toFixed(6) }} y:{{ result.y1.toFixed(6) }}
        w:{{ (result.x2 - result.x1).toFixed(2) }} h:{{ (result.y2 - result.y1).toFixed(2) }}
        color:{{ result.color.join(', ') }}
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ObjectDetector',
  data() {
    return {
      worker: null,
      boxes: [],
      interval: null,
      busy: false,
      detectionResults: [],
      stream: null,
      yoloClasses: [
        'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
        'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse',
        'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase',
        'frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard',
        'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
        'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant',
        'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven',
        'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
      ]
    }
  },
  mounted() {
    this.initWorker()
  },
  beforeUnmount() {
    this.stopCamera()
    if (this.worker) {
      this.worker.terminate()
    }
  },
  methods: {
    initWorker() {
      // 直接使用 public 目录下的 worker 文件
      this.worker = new Worker('/detector.worker.js')
      this.worker.onmessage = this.handleWorkerMessage
    },
    async startCamera() {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true })
        const video = this.$refs.video
        video.srcObject = this.stream
        video.play()

        const canvas = this.$refs.canvas
        canvas.width = 640
        canvas.height = 480
        
        this.startDetection()
      } catch (err) {
        console.error('Error accessing camera:', err)
      }
    },
    stopCamera() {
      if (this.interval) {
        clearInterval(this.interval)
        this.interval = null
      }
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop())
        this.stream = null
      }
      const video = this.$refs.video
      if (video) {
        video.srcObject = null
      }
      this.detectionResults = []
    },
    startDetection() {
      const video = this.$refs.video
      const canvas = this.$refs.canvas
      const context = canvas.getContext('2d')

      this.interval = setInterval(() => {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        this.drawBoxes(canvas, this.boxes)
        
        if (!this.busy) {
          const input = this.prepareInput(canvas)
          this.worker.postMessage(input)
          this.busy = true
        }
      }, 30)
    },
    handleWorkerMessage(event) {
      const output = event.data
      const canvas = this.$refs.canvas
      this.boxes = this.processOutput(output, canvas.width, canvas.height)
      this.updateDetectionResults()
      this.busy = false
    },
    prepareInput(img) {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 640
      const context = canvas.getContext('2d')
      context.drawImage(img, 0, 0, 640, 640)
      const data = context.getImageData(0, 0, 640, 640).data
      const red = [], green = [], blue = []
      for (let index = 0; index < data.length; index += 4) {
        red.push(data[index] / 255)
        green.push(data[index + 1] / 255)
        blue.push(data[index + 2] / 255)
      }
      return [...red, ...green, ...blue]
    },
    processOutput(output, imgWidth, imgHeight) {
      let boxes = []
      for (let index = 0; index < 8400; index++) {
        const [classId, prob] = [...Array(this.yoloClasses.length).keys()]
          .map(col => [col, output[8400 * (col + 4) + index]])
          .reduce((accum, item) => item[1] > accum[1] ? item : accum, [0, 0])
        
        if (prob < 0.5) continue
        
        const label = this.yoloClasses[classId]
        const xc = output[index]
        const yc = output[8400 + index]
        const w = output[2 * 8400 + index]
        const h = output[3 * 8400 + index]
        const x1 = (xc - w / 2) / 640 * imgWidth
        const y1 = (yc - h / 2) / 640 * imgHeight
        const x2 = (xc + w / 2) / 640 * imgWidth
        const y2 = (yc + h / 2) / 640 * imgHeight
        
        // Generate a random color for each class
        const color = [
          Math.floor(Math.random() * 255),
          Math.floor(Math.random() * 255),
          Math.floor(Math.random() * 255)
        ]
        
        boxes.push([x1, y1, x2, y2, label, prob, color])
      }
      
      boxes = boxes.sort((box1, box2) => box2[5] - box1[5])
      const result = []
      while (boxes.length > 0) {
        result.push(boxes[0])
        boxes = boxes.filter(box => this.iou(boxes[0], box) < 0.7 || boxes[0][4] !== box[4])
      }
      return result
    },
    iou(box1, box2) {
      return this.intersection(box1, box2) / this.union(box1, box2)
    },
    union(box1, box2) {
      const [box1x1, box1y1, box1x2, box1y2] = box1
      const [box2x1, box2y1, box2x2, box2y2] = box2
      const box1Area = (box1x2 - box1x1) * (box1y2 - box1y1)
      const box2Area = (box2x2 - box2x1) * (box2y2 - box2y1)
      return box1Area + box2Area - this.intersection(box1, box2)
    },
    intersection(box1, box2) {
      const [box1x1, box1y1, box1x2, box1y2] = box1
      const [box2x1, box2y1, box2x2, box2y2] = box2
      const x1 = Math.max(box1x1, box2x1)
      const y1 = Math.max(box1y1, box2y1)
      const x2 = Math.min(box1x2, box2x2)
      const y2 = Math.min(box1y2, box2y2)
      return Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
    },
    drawBoxes(canvas, boxes) {
      const ctx = canvas.getContext('2d')
      ctx.lineWidth = 3
      ctx.font = '18px serif'
      
      boxes.forEach(([x1, y1, x2, y2, label, , color]) => {
        const [r, g, b] = color
        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.2)`
        
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
        
        // Draw label background
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        const width = ctx.measureText(label).width
        ctx.fillRect(x1, y1 - 25, width + 10, 25)
        
        // Draw label text
        ctx.fillStyle = '#FFFFFF'
        ctx.fillText(label, x1 + 5, y1 - 5)
      })
    },
    updateDetectionResults() {
      this.detectionResults = this.boxes.map(([x1, y1, x2, y2, label, prob, color]) => ({
        label,
        prob,
        x1,
        y1,
        x2,
        y2,
        color
      }))
    }
  }
}
</script>

<style scoped>
.detector-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
}

.detection-canvas {
  border: 2px solid #333;
  margin: 20px 0;
}

.controls {
  margin-bottom: 20px;
}

.controls button {
  margin: 0 10px;
  padding: 8px 16px;
  font-size: 16px;
  cursor: pointer;
}

.detection-results {
  width: 100%;
  max-width: 640px;
  margin-top: 20px;
}

.result-item {
  padding: 8px;
  margin: 4px 0;
  background-color: #f5f5f5;
  border-radius: 4px;
  font-family: monospace;
}
</style>
