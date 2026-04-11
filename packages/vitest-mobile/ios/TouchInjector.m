/**
 * TouchInjector — frame-synced touch event injection.
 *
 * Adapted from Detox's DTXTouchInjector (Apache-2.0, Copyright 2016 Google Inc.)
 * Uses the Detox hybrid pattern: UITouch objects with IOHIDDigitizerFingerEvent
 * attached, dispatched via [UIApplication sendEvent:]. CADisplayLink ensures
 * events are delivered in sync with the display refresh for smooth gestures.
 */

#import "TouchInjector.h"
#import "AppleInternals.h"
#import <QuartzCore/QuartzCore.h>

// ── TouchInfo (one entry in the injection queue) ────────────────────

@interface TouchInfo : NSObject
@property (nonatomic, readonly) NSArray<NSValue *> *points;
@property (nonatomic, assign) TouchPhase phase;
@property (nonatomic, readonly) NSTimeInterval delay;
@property (nonatomic) NSTimeInterval enqueuedTime;
@end

@implementation TouchInfo

- (instancetype)initWithPoints:(NSArray<NSValue *> *)points
                         phase:(TouchPhase)phase
                         delay:(NSTimeInterval)delay {
    self = [super init];
    if (self) {
        _points = points;
        _phase = phase;
        _delay = delay;
    }
    return self;
}

- (NSTimeInterval)fireTime {
    return _enqueuedTime + _delay;
}

@end

// ── TouchInjector ───────────────────────────────────────────────────

@implementation TouchInjector {
    UIWindow *_window;
    NSMutableArray<TouchInfo *> *_queue;
    NSMutableArray<UITouch *> *_activeTouches;
    CADisplayLink *_displayLink;
    TouchInfo *_previousInfo;
}

- (instancetype)initWithWindow:(UIWindow *)window {
    NSParameterAssert(window != nil);
    self = [super init];
    if (self) {
        _window = window;
        _queue = [NSMutableArray new];
        _activeTouches = [NSMutableArray new];
        _state = TouchInjectorPending;
    }
    return self;
}

- (void)enqueueTouchAtPoints:(NSArray<NSValue *> *)points
                       phase:(TouchPhase)phase
                       delay:(NSTimeInterval)delay {
    NSParameterAssert(NSThread.isMainThread);
    TouchInfo *info = [[TouchInfo alloc] initWithPoints:points phase:phase delay:delay];
    info.enqueuedTime = _queue.count == 0 ? CACurrentMediaTime() : _queue.lastObject.fireTime;
    [_queue addObject:info];
}

- (void)startInjecting {
    NSParameterAssert(NSThread.isMainThread);
    if (_state == TouchInjectorStarted) return;
    _state = TouchInjectorStarted;
    if (!_displayLink) {
        _displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(tick)];
        [_displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    }
}

- (void)waitUntilDone {
    NSParameterAssert(NSThread.isMainThread);
    if (_state == TouchInjectorPending || _state == TouchInjectorStopped) {
        [self startInjecting];
    }
    // RunLoop spin until injection completes (no XCTest dependency)
    while (_state != TouchInjectorStopped) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                 beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
    }
}

// ── Display link callback ───────────────────────────────────────────

- (void)tick {
    CFTimeInterval now = CACurrentMediaTime();

    // Find the next event that's ready to fire
    TouchInfo *info = nil;
    if (_queue.count > 0 && _queue.firstObject.fireTime <= now) {
        info = _queue.firstObject;
        [_queue removeObjectAtIndex:0];
    }

    if (!info) {
        if (_queue.count == 0) {
            [self stop];
        }
        return;
    }

    if (_activeTouches.count == 0) {
        [self beginTouches:info];
    } else if (info.phase == TouchPhaseEnded) {
        [self endTouches:info];
    } else {
        [self moveTouches:info];
    }

    [self injectTouches:info];
}

// ── Touch lifecycle ─────────────────────────────────────────────────

- (void)beginTouches:(TouchInfo *)info {
    for (NSValue *pointValue in info.points) {
        CGPoint point = pointValue.CGPointValue;
        UITouch *touch = [self createTouchAtPoint:point];
        [_activeTouches addObject:touch];
    }
}

- (void)moveTouches:(TouchInfo *)info {
    for (NSUInteger i = 0; i < info.points.count && i < _activeTouches.count; i++) {
        CGPoint point = info.points[i].CGPointValue;
        UITouch *touch = _activeTouches[i];
        CGPoint previous = _previousInfo ? _previousInfo.points[i].CGPointValue : point;
        [touch _setLocationInWindow:point resetPrevious:NO];
        [touch setPhase:CGPointEqualToPoint(previous, point) ? UITouchPhaseStationary : UITouchPhaseMoved];
    }
}

- (void)endTouches:(TouchInfo *)info {
    for (NSUInteger i = 0; i < _activeTouches.count; i++) {
        UITouch *touch = _activeTouches[i];
        [touch setPhase:UITouchPhaseEnded];
    }
}

// ── UITouch creation ────────────────────────────────────────────────

- (UITouch *)createTouchAtPoint:(CGPoint)point {
    UITouch *touch = [[UITouch alloc] init];
    [touch setTapCount:1];
    [touch setPhase:UITouchPhaseBegan];
    [touch setWindow:_window];
    [touch _setLocationInWindow:point resetPrevious:YES];
    [touch setView:[_window hitTest:point withEvent:nil]];
    [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];

    // iOS 14+ changed how touch flags work
    if (@available(iOS 14.0, *)) {
        [touch _setIsTapToClick:YES];
        // Set _firstTouchForView flag directly via ivar (Detox approach)
        Ivar flagsIvar = class_getInstanceVariable(object_getClass(touch), "_touchFlags");
        if (flagsIvar) {
            ptrdiff_t offset = ivar_getOffset(flagsIvar);
            char *flags = (__bridge void *)touch + offset;
            *flags = *flags | (char)0x01;
        }
    } else {
        [touch setIsTap:YES];
        [touch _setIsFirstTouchForView:YES];
    }

    return touch;
}

// ── Event injection ─────────────────────────────────────────────────

- (void)injectTouches:(TouchInfo *)info {
    UITouchesEvent *event = [[UIApplication sharedApplication] _touchesEvent];
    [event _clearTouches];

    NSMutableArray *hidEvents = [NSMutableArray arrayWithCapacity:_activeTouches.count];

    uint64_t machTime = mach_absolute_time();
    AbsoluteTime timeStamp;
    timeStamp.hi = (UInt32)(machTime >> 32);
    timeStamp.lo = (UInt32)(machTime);

    for (NSUInteger i = 0; i < _activeTouches.count; i++) {
        UITouch *touch = _activeTouches[i];
        [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];

        IOHIDDigitizerEventMask eventMask = (touch.phase == UITouchPhaseMoved)
            ? kIOHIDDigitizerEventPosition
            : (kIOHIDDigitizerEventRange | kIOHIDDigitizerEventTouch);

        CGPoint location = [touch locationInView:_window];
        Boolean isActive = (touch.phase != UITouchPhaseEnded);

        IOHIDEventRef hidEvent = IOHIDEventCreateDigitizerFingerEvent(
            kCFAllocatorDefault, timeStamp,
            (uint32_t)i,   // index
            2,             // identity (matches Detox)
            eventMask,
            location.x, location.y, 0,  // x, y, z
            0, 0,          // pressure, twist
            isActive,      // range
            isActive,      // touch
            0              // options
        );

        [hidEvents addObject:[NSValue valueWithPointer:hidEvent]];

        if ([touch respondsToSelector:@selector(_setHidEvent:)]) {
            [touch _setHidEvent:hidEvent];
        }

        [event _addTouch:touch forDelayedDelivery:NO];
    }

    if (hidEvents.count > 0) {
        [event _setHIDEvent:[hidEvents.firstObject pointerValue]];
    }

    @autoreleasepool {
        _previousInfo = info;
        @try {
            [[UIApplication sharedApplication] sendEvent:event];
        } @catch (NSException *e) {
            [self stop];
            @throw;
        } @finally {
            [event _clearTouches];
            for (NSValue *val in hidEvents) {
                CFRelease([val pointerValue]);
            }
            if (info.phase == TouchPhaseEnded) {
                [_activeTouches removeAllObjects];
            }
        }
    }
}

// ── Cleanup ─────────────────────────────────────────────────────────

- (void)stop {
    _state = TouchInjectorStopped;
    [_displayLink invalidate];
    _displayLink = nil;
    [_queue removeAllObjects];
}

@end
