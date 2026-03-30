#import "TouchSynthesizer.h"
#import <dlfcn.h>
#import <objc/runtime.h>

// ── Private API declarations ───────────────────────────────────────
// These are the same private APIs used by Detox, EarlGrey, and Hammer.
// They have been stable since iOS 9.

@interface UITouch (Synthesis)
- (instancetype)initAtPoint:(CGPoint)point relativeToWindow:(UIWindow *)window;
- (void)setPhase:(UITouchPhase)phase;
- (void)_setLocationInWindow:(CGPoint)location resetPrevious:(BOOL)resetPrevious;
- (void)setTapCount:(NSUInteger)tapCount;
- (void)setTimestamp:(NSTimeInterval)timestamp;
- (void)setWindow:(UIWindow *)window;
- (void)setView:(UIView *)view;
- (void)_setHidEvent:(id)event;
- (void)_setIsTapToClick:(BOOL)isTapToClick;
@end

@interface UIApplication (Synthesis)
- (UIEvent *)_touchesEvent;
@end

@interface UIEvent (Synthesis)
- (void)_clearTouches;
- (void)_addTouch:(UITouch *)touch forDelayedDelivery:(BOOL)delayed;
- (void)_setHIDEvent:(id)event;
@end

// IOKit function for creating HID digitizer events
typedef void *IOHIDEventRef;

typedef IOHIDEventRef (*IOHIDEventCreateDigitizerFingerEventFunc)(
    CFAllocatorRef allocator,
    uint64_t timeStamp,
    uint32_t index,
    uint32_t identity,
    uint32_t eventMask,
    float x, float y, float z,
    float tipPressure, float twist,
    BOOL isRange, BOOL isTouch,
    uint32_t options
);

static IOHIDEventCreateDigitizerFingerEventFunc _fingerEventCreate = NULL;

static void ensureIOKit(void) {
    if (!_fingerEventCreate) {
        void *handle = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_LAZY);
        if (handle) {
            _fingerEventCreate = (IOHIDEventCreateDigitizerFingerEventFunc)dlsym(handle, "IOHIDEventCreateDigitizerFingerEvent");
        }
    }
}

// ── Touch synthesis ────────────────────────────────────────────────

@implementation TouchSynthesizer

+ (void)tapAtPoint:(CGPoint)point inWindow:(UIWindow *)window completion:(void (^)(void))completion {
    ensureIOKit();

    // Begin touch
    [self sendTouchAtPoint:point phase:UITouchPhaseBegan window:window];

    // End touch after a short delay (simulates a real finger lift)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self sendTouchAtPoint:point phase:UITouchPhaseEnded window:window];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            completion();
        });
    });
}

+ (void)longPressAtPoint:(CGPoint)point inWindow:(UIWindow *)window duration:(NSTimeInterval)duration completion:(void (^)(void))completion {
    ensureIOKit();

    [self sendTouchAtPoint:point phase:UITouchPhaseBegan window:window];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(duration * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self sendTouchAtPoint:point phase:UITouchPhaseEnded window:window];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            completion();
        });
    });
}

+ (void)sendTouchAtPoint:(CGPoint)point phase:(UITouchPhase)phase window:(UIWindow *)window {
    static UITouch *currentTouch = nil;

    NSTimeInterval timestamp = [[NSProcessInfo processInfo] systemUptime];

    if (phase == UITouchPhaseBegan) {
        currentTouch = [[UITouch alloc] initAtPoint:point relativeToWindow:window];
        [currentTouch setTapCount:1];

        // iOS 14+ requires this flag for proper touch handling
        if ([currentTouch respondsToSelector:@selector(_setIsTapToClick:)]) {
            [currentTouch _setIsTapToClick:YES];
        }
    }

    if (!currentTouch) return;

    [currentTouch setPhase:phase];
    [currentTouch _setLocationInWindow:point resetPrevious:YES];
    [currentTouch setTimestamp:timestamp];

    // Create HID event
    IOHIDEventRef hidEvent = NULL;
    if (_fingerEventCreate) {
        BOOL isTouch = (phase != UITouchPhaseEnded && phase != UITouchPhaseCancelled);
        float pressure = isTouch ? 1.0f : 0.0f;

        // Event mask: 1 = range, 2 = touch, 4 = position
        uint32_t eventMask = isTouch ? (1 | 2 | 4) : (1 | 4);

        hidEvent = _fingerEventCreate(
            kCFAllocatorDefault,
            (uint64_t)(timestamp * 1e9),  // nanoseconds
            0,      // index
            2,      // identity
            eventMask,
            (float)point.x, (float)point.y, 0.0f,
            pressure, 0.0f,
            isTouch, // isRange
            isTouch, // isTouch
            0        // options
        );
    }

    // Pack into UITouchesEvent and dispatch
    UIEvent *touchesEvent = [[UIApplication sharedApplication] _touchesEvent];
    [touchesEvent _clearTouches];

    if (hidEvent) {
        [currentTouch _setHidEvent:(__bridge id)hidEvent];
        [(id)touchesEvent _setHIDEvent:(__bridge id)hidEvent];
    }

    [touchesEvent _addTouch:currentTouch forDelayedDelivery:NO];
    [[UIApplication sharedApplication] sendEvent:touchesEvent];

    if (hidEvent) {
        CFRelease(hidEvent);
    }

    if (phase == UITouchPhaseEnded || phase == UITouchPhaseCancelled) {
        currentTouch = nil;
    }
}

@end
