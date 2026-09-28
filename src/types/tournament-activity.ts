export interface TournamentActivityStoryPart {
  text: string;
  href?: string;
}

export type TournamentActivityStory = TournamentActivityStoryPart[];
export type TournamentJoinStoryPart = TournamentActivityStoryPart;
export type TournamentJoinStory = TournamentActivityStory;

export interface TournamentMatchArrangeStorySnapshot {
  eventAt: string | null;
  story: TournamentActivityStory;
}

export interface TournamentReserveStorySnapshot {
  eventAt: string | null;
  story: TournamentActivityStory;
}
