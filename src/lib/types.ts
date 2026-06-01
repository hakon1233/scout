export type Interest = { id: string; topic: string };

export type Article = {
  id: string;
  title: string;
  url: string;
  publishedDate?: string;
  publishedAt?: string;
  author?: string;
  source?: string;
  text?: string;
  interest: string;
};

export type Brief = {
  id: string;
  generatedAt: string;
  interests: string[];
  articles: Article[];
  markdown: string;
  failedTopics?: string[];
};

export type Settings = {
  name: string;
  interests: Interest[];
};
