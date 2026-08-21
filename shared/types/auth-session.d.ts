import type { AuthUserDto } from 'nbook/shared/dto/auth.dto'

declare module '#auth-utils' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface User extends AuthUserDto {}

  interface UserSession {
    user?: User
  }
}

export {}
