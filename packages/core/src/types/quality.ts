export type QualityGrade = 'A' | 'B' | 'C' | 'D';

export interface QualityReport {
  id: string;
  passportId: string;
  inspectorId: string;
  structuralScore: number | null; // 1–10
  aestheticScore: number | null; // 1–10
  environmentalScore: number | null; // 1–10
  overallGrade: QualityGrade | null;
  reportNotes: string | null;
  photoUrls: string[];
  blockchainTxHash: string | null;
  disputed: boolean;
  createdAt: Date;
}
