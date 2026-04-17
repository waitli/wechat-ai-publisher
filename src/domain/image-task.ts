export type ImageTask = {
  kind: "cover" | "inline";
  prompt: string;
  index: number;
};

export type GeneratedImage = {
  task: ImageTask;
  localPath: string;
};

