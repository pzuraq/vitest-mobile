#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Synthesizes real UITouch events dispatched through UIApplication.sendEvent:.
/// Uses the same private API approach as Detox and Lyft's Hammer.
@interface TouchSynthesizer : NSObject

/// Dispatch a single tap at the given window-space point.
+ (void)tapAtPoint:(CGPoint)point inWindow:(UIWindow *)window completion:(void (^)(void))completion;

/// Dispatch a long press at the given point with specified duration.
+ (void)longPressAtPoint:(CGPoint)point inWindow:(UIWindow *)window duration:(NSTimeInterval)duration completion:(void (^)(void))completion;

@end

NS_ASSUME_NONNULL_END
