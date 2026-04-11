#import <UIKit/UIKit.h>

#ifdef __cplusplus
#import <VitestMobileHarnessSpec/VitestMobileHarnessSpec.h>
#endif

#ifdef __cplusplus
@interface VitestMobileHarness : NSObject <NativeVitestMobileHarnessSpec>
#else
@interface VitestMobileHarness : NSObject
#endif
+ (UIWindow * _Nullable)activeWindow;
@end
