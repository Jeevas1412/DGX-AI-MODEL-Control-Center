export const MODEL_SERVICE_TEMPLATES = Object.freeze([
  Object.freeze({ id: 'openai-compatible-text', kind: 'text', displayName: '文本推理服务', status: 'requires-adapter', actions: Object.freeze(['warmup', 'restart', 'stop']) }),
  Object.freeze({ id: 'exclusive-text-inference', kind: 'text', displayName: '独占式文本推理服务（启用会停止其他 LLM）', status: 'requires-adapter', actions: Object.freeze(['warmup', 'restart', 'stop']) }),
  Object.freeze({ id: 'openai-compatible-vision', kind: 'vision', displayName: '视觉语言服务', status: 'requires-adapter', actions: Object.freeze(['warmup', 'restart', 'stop']) }),
  Object.freeze({ id: 'image-workflow', kind: 'image', displayName: '图像工作流服务', status: 'requires-adapter', actions: Object.freeze(['warmup', 'restart', 'stop']) }),
]);

export function findModelServiceTemplate(id) {
  return MODEL_SERVICE_TEMPLATES.find((template) => template.id === id) ?? null;
}
