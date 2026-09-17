export type UserRole = 'customer' | 'agent';

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
};

export function isUserRole(value: string): value is UserRole {
  return value === 'customer' || value === 'agent';
}
