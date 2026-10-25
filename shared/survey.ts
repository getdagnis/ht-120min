export type SurveyVariant = 'flag_hunters' | 'exotic_hfi';
export type SurveyPriority = 'flags' | 'domestic' | '120m' | 'both' | 'fun';
export type SurveyImportance = 'high' | 'nice' | 'depends' | 'regular';

export const surveyPriorities: Record<SurveyVariant, readonly { value: SurveyPriority; label: string }[]> = {
  flag_hunters: [
    { value: 'flags', label: '🇲🇵 Collecting new flags' },
    { value: '120m', label: '⏱ 120-minute matches' },
    { value: 'both', label: '🖇 Both are equally important to this team' },
    { value: 'fun', label: "🥂 It's here for challenge, fun and no-hassle friendlies" },
  ],
  exotic_hfi: [
    { value: 'domestic', label: '🏟 Playing domestic HFI friendlies' },
    { value: '120m', label: '⏱ 120-minute matches' },
    { value: 'both', label: '🖇 Both are equally important to this team' },
    { value: 'fun', label: "🥂 It's here for challenge, fun and no-hassle friendlies" },
  ],
};

export const surveyImportance: readonly { value: SurveyImportance; label: string }[] = [
  { value: 'high', label: '☝️ Highly important' },
  { value: 'nice', label: '👌 Nice to have' },
  { value: 'depends', label: '⚽️ Depends on team or current training plan' },
  { value: 'regular', label: "🏛 I'd prefer regular matches" },
];
