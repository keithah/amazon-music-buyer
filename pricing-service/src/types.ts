export interface MusicItem {
  artist: string;
  song: string;
  album?: string;
}

export interface PriceInfo extends MusicItem {
  trackPrice: number;
  albumPrice?: number;
  albumName?: string;
  trackCount?: number;
  available: boolean;
  searchQuery: string;
  error?: string;
}

export interface AlbumAnalysis {
  albumName: string;
  artist: string;
  albumPrice: number;
  tracks: string[];
  trackCount: number;
  totalTrackPrice: number;
  savings: number;
  recommendation: string;
}

export interface PricingReport {
  timestamp: string;
  totalTracks: number;
  availableTracks: number;
  totalCost: number;
  optimizedCost: number;
  totalSavings: number;
  savingsPercentage: number;
  tracks: PriceInfo[];
  albumAnalysis: AlbumAnalysis[];
  recommendations: string[];
}

export interface PricingOptions {
  headless?: boolean;
  outputJson?: string;
  outputCsv?: string;
  delay?: number;
  maxRetries?: number;
}