import creationTips from './creation-tips.json';

export interface CreationTip {
  id: string;
  title: string;
  body: string;
}

export const CREATION_TIPS = creationTips as CreationTip[];
