export interface ADFNode {
  type: string;
  attrs?: Record<string, any>;
  content?: ADFNode[];
  marks?: any[];
  text?: string;
}
