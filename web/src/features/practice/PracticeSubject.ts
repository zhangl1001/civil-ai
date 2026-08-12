export const PracticeSubject = {
  Aptitude: 'aptitude',
  Essay: 'essay'
} as const;

export type PracticeSubject = typeof PracticeSubject[keyof typeof PracticeSubject];

export function practiceSubjectLabel(subject: PracticeSubject): string {
  return subject === PracticeSubject.Essay ? '申论' : '行测';
}
