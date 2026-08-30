/**
 * Project Workbench Client package, Node half.
 *
 * The empty named apply function gives the Host Loader a lifecycle seat. The
 * browser implementation is discovered independently through `dsh.client`
 * and `exports["./client"]`.
 */

/** Host plugin body — this package owns browser behavior only. */
export function apply(): void {}
