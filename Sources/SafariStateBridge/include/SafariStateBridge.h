#import <Foundation/Foundation.h>
NS_ASSUME_NONNULL_BEGIN
// The macOS SDK marks the Swift callback MainActor, but Safari invokes it on
// its XPC reply queue. Return scalar state through an unisolated native bridge.
void ADVGetSafariExtensionEnabled(NSString *identifier, void (^completion)(BOOL, NSError * _Nullable));
NS_ASSUME_NONNULL_END
