declare module 'ignore' {
  export interface Ignore {
    add(patterns: string | readonly string[] | Ignore): Ignore;
    ignores(pathname: string): boolean;
  }

  export interface IgnoreFactory {
    (): Ignore;
  }

  const ignore: IgnoreFactory;
  export default ignore;
}
