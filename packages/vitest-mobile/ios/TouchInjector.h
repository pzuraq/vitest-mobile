/**
 * TouchInjector — frame-synced touch event injection.
 *
 * Adapted from Detox's DTXTouchInjector (Apache-2.0, Copyright 2016 Google Inc.)
 * Simplified for vitest-mobile: no XCTest dependency, RunLoop-based waiting.
 */

#import <UIKit/UIKit.h>

typedef NS_ENUM(NSUInteger, TouchPhase) {
    TouchPhaseBegan,
    TouchPhaseMoved,
    TouchPhaseEnded,
};

typedef NS_ENUM(NSUInteger, TouchInjectorState) {
    TouchInjectorPending,
    TouchInjectorStarted,
    TouchInjectorStopped,
};

@interface TouchInjector : NSObject

- (instancetype)initWithWindow:(UIWindow *)window;

/**
 * Enqueue a touch event for delivery on the next display frame.
 * @param points Array of NSValue-wrapped CGPoints (one per finger).
 * @param phase  Touch phase (began, moved, ended).
 * @param delay  Seconds to wait after the previous event before delivering this one.
 */
- (void)enqueueTouchAtPoints:(NSArray<NSValue *> *)points
                       phase:(TouchPhase)phase
                       delay:(NSTimeInterval)delay;

/**
 * Begin injecting enqueued touches via CADisplayLink.
 */
- (void)startInjecting;

/**
 * Block until all enqueued touches have been delivered.
 * Uses RunLoop spinning (no XCTest dependency).
 */
- (void)waitUntilDone;

@property (nonatomic, readonly) TouchInjectorState state;

@end
