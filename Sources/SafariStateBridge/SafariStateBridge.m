#import "SafariStateBridge.h"
#import <TargetConditionals.h>
#if TARGET_OS_OSX
#import <SafariServices/SafariServices.h>
#endif

void ADVGetSafariExtensionEnabled(NSString *identifier, void (^completion)(BOOL, NSError *)) {
#if TARGET_OS_OSX
    [SFSafariExtensionManager getStateOfSafariExtensionWithIdentifier:identifier completionHandler:^(SFSafariExtensionState *state, NSError *error) {
        completion(state.isEnabled, error ?: (state ? nil : [NSError errorWithDomain:@"ADV" code:20 userInfo:nil]));
    }];
#else
    completion(NO, [NSError errorWithDomain:@"ADV" code:21 userInfo:nil]);
#endif
}
