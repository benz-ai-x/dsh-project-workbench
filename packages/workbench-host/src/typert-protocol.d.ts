/**
 * External-workspace Typert identity facade.
 *
 * The generator recognizes protocol decorators by the owning ambient module;
 * runtime JavaScript still resolves the pinned linked protocol package.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  export interface RemoteFailure {
    readonly code: string
    readonly message: string
    readonly details: object
  }

  export type RemoteResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: RemoteFailure }

  export class TypertRemoteFailure extends Error {
    readonly failure: RemoteFailure
    constructor(failure: RemoteFailure)
  }

  export interface TypertGatewayBinding<Owner extends object> {
    readonly service: Owner
    readonly serviceKey: string
    readonly namespace: string
  }

  export interface TypertRemoteMap {}
  export interface TypertRemoteScopeMap {}

  export type TypertRemoteNamespace<Namespace extends string> = {
    [Endpoint in keyof TypertRemoteMap as Endpoint extends `${Namespace}/${infer Method}`
      ? Method
      : never]: TypertRemoteMap[Endpoint]
  }

  export interface TypertRemoteNamespaceMap {}

  export interface TypertRemoteContribution {
    readonly package: string
    readonly descriptors: readonly unknown[]
  }

  export interface RemoteMethodMarker {
    readonly method: string
    readonly implementation?: string
    readonly mode?: 'stream'
    readonly invocation:
      | { readonly kind: 'direct' }
      | { readonly kind: 'context'; readonly context: string }
  }

  export abstract class TypertRemoteService<T = never> {
    readonly typertRemote: TypertGatewayBinding<this>
    protected constructor(
      ctx: unknown,
      serviceKey: string,
      options?: { readonly namespace?: string },
    )
  }

  export function Remote<This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void

  export function Remote(option: string | { readonly mode: 'stream' }):
  <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void

  export function remoteMethods(service: object): readonly RemoteMethodMarker[]
}
