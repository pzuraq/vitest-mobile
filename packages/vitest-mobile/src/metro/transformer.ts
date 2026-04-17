/**
 * Custom Metro transformer that wraps @react-native/metro-babel-transformer
 * and automatically injects the vitest-mobile test-wrapper Babel plugin.
 *
 * This eliminates the need for users to add the plugin to their babel.config.
 */

// @ts-expect-error — no type declarations for this module
import upstreamTransformer from '@react-native/metro-babel-transformer';
import testWrapperPlugin from '../babel/test-wrapper-plugin';

interface TransformProps {
  filename: string;
  options: Record<string, unknown>;
  src: string;
  plugins?: unknown[];
}

export const getCacheKey = upstreamTransformer.getCacheKey;

export function transform(props: TransformProps) {
  return upstreamTransformer.transform({
    ...props,
    plugins: [...(props.plugins ?? []), testWrapperPlugin],
  });
}
