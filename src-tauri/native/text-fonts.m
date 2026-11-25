#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>

// Office's local Yu Gothic collection is not necessarily installed system-wide.
void pp_register_yu_gothic(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        if ([(__bridge_transfer NSArray *)CTFontManagerCopyAvailableFontFamilyNames() containsObject:@"Yu Gothic"]) return;
        NSURL *app = [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:@"com.microsoft.Powerpoint"];
        NSURL *directory = [app URLByAppendingPathComponent:@"Contents/Resources/DFonts"];
        if (!directory) return;
        for (NSString *name in @[@"YuGothR.ttc", @"YuGothB.ttc", @"YuGothM.ttc", @"YuGothL.ttc"]) {
            NSURL *url = [directory URLByAppendingPathComponent:name];
            CTFontManagerRegisterFontsForURL((__bridge CFURLRef)url, kCTFontManagerScopeProcess, NULL);
        }
    });
}
