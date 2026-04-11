#import "VitestMobileHarness.h"
#import "TouchInjector.h"
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

static NSMapTable<NSString *, UIView *> *_viewRegistry;

@implementation VitestMobileHarness

+ (void)initialize {
  if (self == [VitestMobileHarness class]) {
    _viewRegistry = [NSMapTable strongToWeakObjectsMapTable];
  }
}

#pragma mark - Window Access

+ (UIWindow *)activeWindow {
  if (@available(iOS 15.0, *)) {
    UIWindow *firstWindow = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if ([scene isKindOfClass:[UIWindowScene class]]) {
        UIWindowScene *windowScene = (UIWindowScene *)scene;
        for (UIWindow *window in windowScene.windows) {
          if (window.isKeyWindow) return window;
          if (!firstWindow) firstWindow = window;
        }
      }
    }
    if (firstWindow) return firstWindow;
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  UIWindow *key = UIApplication.sharedApplication.keyWindow;
  if (key) return key;
  return UIApplication.sharedApplication.windows.firstObject;
#pragma clang diagnostic pop
}

#pragma mark - View Registry

+ (NSString *)registerView:(UIView *)view {
  NSString *nativeId = [[NSUUID UUID] UUIDString];
  [_viewRegistry setObject:view forKey:nativeId];
  return nativeId;
}

+ (UIView *)viewForId:(NSString *)nativeId {
  return [_viewRegistry objectForKey:nativeId];
}

#pragma mark - View Queries

+ (UIView *)findFirstView:(UIView *)root matching:(BOOL (^)(UIView *))predicate {
  NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:root];
  while (queue.count > 0) {
    UIView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if (predicate(view)) return view;
    [queue addObjectsFromArray:view.subviews];
  }
  return nil;
}

+ (NSArray<UIView *> *)findAllViews:(UIView *)root matching:(BOOL (^)(UIView *))predicate {
  NSMutableArray<UIView *> *results = [NSMutableArray new];
  NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:root];
  while (queue.count > 0) {
    UIView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if (predicate(view)) [results addObject:view];
    [queue addObjectsFromArray:view.subviews];
  }
  return results;
}

+ (NSDictionary *)viewInfoForView:(UIView *)view {
  UIWindow *window = [self activeWindow];
  CGRect frame = [view convertRect:view.bounds toView:window];
  NSString *nativeId = [self registerView:view];
  return @{
    @"nativeId": nativeId,
    @"x": @(frame.origin.x),
    @"y": @(frame.origin.y),
    @"width": @(frame.size.width),
    @"height": @(frame.size.height),
  };
}

+ (NSString *)readText:(UIView *)view {
  if ([view isKindOfClass:[UILabel class]]) return ((UILabel *)view).text;
  if ([view isKindOfClass:[UITextField class]]) return ((UITextField *)view).text;
  if ([view isKindOfClass:[UITextView class]]) return ((UITextView *)view).text;
  NSString *a11yLabel = view.accessibilityLabel;
  if (a11yLabel.length > 0) return a11yLabel;
  NSMutableArray *texts = [NSMutableArray new];
  for (UIView *sub in view.subviews) {
    NSString *t = [self readText:sub];
    if (t.length > 0) [texts addObject:t];
  }
  return texts.count > 0 ? [texts componentsJoinedByString:@" "] : nil;
}

#pragma mark - Sync Query API (dispatch_sync to UI thread)

static void dispatchSyncMain(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

- (NSDictionary *)queryByTestId:(NSString *)testId {
  __block NSDictionary *result = nil;
  dispatchSyncMain(^{
    UIWindow *window = [VitestMobileHarness activeWindow];
    if (!window) return;
    UIView *view = [VitestMobileHarness findFirstView:window matching:^BOOL(UIView *v) {
      return [v.accessibilityIdentifier isEqualToString:testId];
    }];
    if (view) result = [VitestMobileHarness viewInfoForView:view];
  });
  return result;
}

- (NSArray *)queryAllByTestId:(NSString *)testId {
  __block NSArray *result = @[];
  dispatchSyncMain(^{
    UIWindow *window = [VitestMobileHarness activeWindow];
    if (!window) return;
    NSArray<UIView *> *views = [VitestMobileHarness findAllViews:window matching:^BOOL(UIView *v) {
      return [v.accessibilityIdentifier isEqualToString:testId];
    }];
    NSMutableArray *infos = [NSMutableArray new];
    for (UIView *v in views) [infos addObject:[VitestMobileHarness viewInfoForView:v]];
    result = infos;
  });
  return result;
}

- (NSDictionary *)queryByText:(NSString *)text {
  __block NSDictionary *result = nil;
  dispatchSyncMain(^{
    UIWindow *window = [VitestMobileHarness activeWindow];
    if (!window) return;
    UIView *view = [VitestMobileHarness findFirstView:window matching:^BOOL(UIView *v) {
      NSString *t = [VitestMobileHarness readText:v];
      return t && [t containsString:text];
    }];
    if (view) result = [VitestMobileHarness viewInfoForView:view];
  });
  return result;
}

- (NSArray *)queryAllByText:(NSString *)text {
  __block NSArray *result = @[];
  dispatchSyncMain(^{
    UIWindow *window = [VitestMobileHarness activeWindow];
    if (!window) return;
    NSArray<UIView *> *views = [VitestMobileHarness findAllViews:window matching:^BOOL(UIView *v) {
      NSString *t = [VitestMobileHarness readText:v];
      return t && [t containsString:text];
    }];
    NSMutableArray *infos = [NSMutableArray new];
    for (UIView *v in views) [infos addObject:[VitestMobileHarness viewInfoForView:v]];
    result = infos;
  });
  return result;
}

- (NSString *)getText:(NSString *)nativeId {
  __block NSString *result = nil;
  dispatchSyncMain(^{
    UIView *view = [VitestMobileHarness viewForId:nativeId];
    if (view) result = [VitestMobileHarness readText:view];
  });
  return result;
}

- (NSNumber *)isVisible:(NSString *)nativeId {
  __block NSNumber *result = @(NO);
  dispatchSyncMain(^{
    UIView *view = [VitestMobileHarness viewForId:nativeId];
    result = @(view && !view.isHidden && view.alpha > 0.01 && view.window != nil);
  });
  return result;
}

- (NSDictionary *)dumpViewTree {
  __block NSDictionary *result = nil;
  dispatchSyncMain(^{
    UIWindow *window = [VitestMobileHarness activeWindow];
    if (window) result = [VitestMobileHarness buildTreeNode:window];
  });
  return result;
}

#pragma mark - View Tree

+ (NSDictionary *)buildTreeNode:(UIView *)view {
  return [self buildTreeNode:view depth:0 maxDepth:30];
}

+ (NSDictionary *)buildTreeNode:(UIView *)view depth:(int)depth maxDepth:(int)maxDepth {
  if (depth > maxDepth) return nil;
  NSString *type = NSStringFromClass([view class]);
  if ([type hasPrefix:@"RCT"]) type = [type substringFromIndex:3];

  NSMutableArray *children = [NSMutableArray new];
  for (UIView *sub in view.subviews) {
    NSDictionary *child = [self buildTreeNode:sub depth:depth + 1 maxDepth:maxDepth];
    if (child) [children addObject:child];
  }

  NSString *testID = view.accessibilityIdentifier;
  NSString *text = nil;
  if ([view isKindOfClass:[UILabel class]]) text = ((UILabel *)view).text;
  if ([view isKindOfClass:[UITextField class]]) text = ((UITextField *)view).text;

  BOOL isLeaf = children.count == 0;
  if (isLeaf && !testID && !text) return nil;

  CGRect frame = [view convertRect:view.bounds toView:nil];
  NSMutableDictionary *node = [@{
    @"type": type,
    @"visible": @(!view.isHidden && view.alpha > 0.01),
    @"frame": @{
      @"x": @(frame.origin.x),
      @"y": @(frame.origin.y),
      @"width": @(frame.size.width),
      @"height": @(frame.size.height),
    },
    @"children": children,
  } mutableCopy];
  if (testID) node[@"testID"] = testID;
  if (text) node[@"text"] = text;
  return node;
}

#pragma mark - Touch Synthesis (via TouchInjector)

static const NSTimeInterval kTapHoldDuration = 0.05;
static const NSTimeInterval kPostEventSettle = 0.01;

- (void)simulatePress:(NSString *)nativeId
                    x:(double)x
                    y:(double)y
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    CGPoint point = CGPointMake(x, y);
    if (nativeId && nativeId.length > 0) {
      UIView *view = [VitestMobileHarness viewForId:nativeId];
      if (view && view.window) {
        CGRect frameInWindow = [view convertRect:view.bounds toView:view.window];
        point = CGPointMake(CGRectGetMidX(frameInWindow), CGRectGetMidY(frameInWindow));
      }
    }
    UIWindow *window = [VitestMobileHarness activeWindow];
    if (!window) {
      reject(@"NO_WINDOW", @"No active window", nil);
      return;
    }

    NSValue *pointValue = [NSValue valueWithCGPoint:point];
    TouchInjector *injector = [[TouchInjector alloc] initWithWindow:window];
    [injector enqueueTouchAtPoints:@[pointValue] phase:TouchPhaseBegan delay:0];
    [injector enqueueTouchAtPoints:@[pointValue] phase:TouchPhaseEnded delay:kTapHoldDuration];
    [injector waitUntilDone];

    // Small settle delay for React Native to process the event
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPostEventSettle * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
      resolve(nil);
    });
  });
}

#pragma mark - Text Input

- (void)typeChar:(NSString *)character
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *window = [VitestMobileHarness activeWindow];
    if (!window) { reject(@"NO_WINDOW", @"No active window", nil); return; }
    UIResponder *responder = [self findFirstResponderIn:window];
    if ([responder conformsToProtocol:@protocol(UITextInput)]) {
      [(id<UITextInput>)responder insertText:character];
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPostEventSettle * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{ resolve(nil); });
  });
}

- (UIResponder *)findFirstResponderIn:(UIView *)view {
  if ([view isFirstResponder]) return view;
  for (UIView *sub in view.subviews) {
    UIResponder *r = [self findFirstResponderIn:sub];
    if (r) return r;
  }
  return nil;
}

- (void)typeIntoView:(NSString *)nativeId
                text:(NSString *)text
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *view = [VitestMobileHarness viewForId:nativeId];
    if (!view) {
      reject(@"NO_VIEW", @"View not found", nil);
      return;
    }
    UIWindow *window = view.window ?: [VitestMobileHarness activeWindow];
    if (!window) {
      reject(@"NO_WINDOW", @"No window for view", nil);
      return;
    }

    // Tap the view to focus it
    CGRect frameInWindow = [view convertRect:view.bounds toView:window];
    CGPoint center = CGPointMake(CGRectGetMidX(frameInWindow), CGRectGetMidY(frameInWindow));
    NSValue *pointValue = [NSValue valueWithCGPoint:center];
    TouchInjector *injector = [[TouchInjector alloc] initWithWindow:window];
    [injector enqueueTouchAtPoints:@[pointValue] phase:TouchPhaseBegan delay:0];
    [injector enqueueTouchAtPoints:@[pointValue] phase:TouchPhaseEnded delay:kTapHoldDuration];
    [injector waitUntilDone];

    // Wait for focus, then insert text
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
      UIResponder *responder = [self findFirstResponderIn:window];
      if ([responder conformsToProtocol:@protocol(UITextInput)]) {
        [(id<UITextInput>)responder insertText:text];
      }
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)),
                     dispatch_get_main_queue(), ^{ resolve(nil); });
    });
  });
}

#pragma mark - Flush UI Queue

- (void)flushUIQueue:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    dispatch_async(dispatch_get_main_queue(), ^{
      dispatch_async(dispatch_get_main_queue(), ^{
        resolve(nil);
      });
    });
  });
}

#pragma mark - TurboModule

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeVitestMobileHarnessSpecJSI>(params);
}

+ (NSString *)moduleName {
  return @"VitestMobileHarness";
}

@end
