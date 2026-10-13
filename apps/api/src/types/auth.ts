export type AuthTokenPayload = {
  sub: string;
  email: string;
  name: string;
};

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  isDemo: boolean;
};
