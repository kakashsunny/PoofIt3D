export interface Style {
  id: string;
  name: string;
  prompt_prefix?: string;
}

export interface Model {
  id: string;
  name: string;
  description: string;
  huggingface_id: string;
  inference_speed: string;
  recommended_for: string[];
}

export interface GenerationResult {
  generation_id: string;
  status: 'processing' | 'completed' | 'failed';
  message: string;
  image_url?: string;
  quality?: { metric: string; scores: number[]; best_index: number };
  generation_seconds?: number;
}