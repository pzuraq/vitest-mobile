/**
 * Private API declarations for touch synthesis.
 *
 * Exposes UIKit and IOKit interfaces needed to construct and inject synthetic
 * touch events. Adapted from Detox (wix/Detox, Apache-2.0) and EarlGrey
 * (google/EarlGrey, Apache-2.0).
 */

#import <UIKit/UIKit.h>
#include <mach/mach_time.h>
#import <objc/runtime.h>

// ── IOHIDEvent types ────────────────────────────────────────────────

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef UInt32 IOOptionBits;

#ifdef __LP64__
typedef double IOHIDFloat;
#else
typedef float IOHIDFloat;
#endif

typedef enum {
    kIOHIDDigitizerEventRange    = 0x00000001,
    kIOHIDDigitizerEventTouch    = 0x00000002,
    kIOHIDDigitizerEventPosition = 0x00000004,
} IOHIDDigitizerEventMask;

/**
 * Creates a digitizer finger event (IOKit private API).
 * Linked via IOKit.framework — no dlsym needed.
 */
IOHIDEventRef IOHIDEventCreateDigitizerFingerEvent(
    CFAllocatorRef allocator,
    AbsoluteTime timeStamp,
    uint32_t index,
    uint32_t identity,
    IOHIDDigitizerEventMask eventMask,
    IOHIDFloat x,
    IOHIDFloat y,
    IOHIDFloat z,
    IOHIDFloat tipPressure,
    IOHIDFloat twist,
    Boolean range,
    Boolean touch,
    IOOptionBits options
);

// ── UITouch private methods ─────────────────────────────────────────

@interface UITouch (Synthesis)
- (void)setPhase:(UITouchPhase)phase;
- (void)setTapCount:(NSUInteger)tapCount;
- (void)setIsTap:(BOOL)isTap;
- (void)_setIsTapToClick:(BOOL)isTap;
- (void)setTimestamp:(NSTimeInterval)timestamp;
- (void)setWindow:(UIWindow *)window;
- (void)setView:(UIView *)view;
- (void)_setLocationInWindow:(CGPoint)location resetPrevious:(BOOL)reset;
- (void)_setIsFirstTouchForView:(BOOL)first;
- (void)_setHidEvent:(IOHIDEventRef)event;
@end

// ── UIEvent private methods ─────────────────────────────────────────

@interface UITouchesEvent : UIEvent
- (void)_addTouch:(UITouch *)touch forDelayedDelivery:(BOOL)delayed;
- (void)_clearTouches;
- (void)_setHIDEvent:(IOHIDEventRef)event;
@end

@interface UIApplication (Synthesis)
- (UITouchesEvent *)_touchesEvent;
@end
