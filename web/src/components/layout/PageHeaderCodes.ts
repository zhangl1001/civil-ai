export const PageHeaderIcon = {
  Home: 'home',
  Practice: 'practice',
  Study: 'study',
  WrongBook: 'wrongbook',
  Profile: 'profile'
} as const;

export type PageHeaderIcon = typeof PageHeaderIcon[keyof typeof PageHeaderIcon];
