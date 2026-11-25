#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>

// Office fonts may only be registered in PowerPoint's process. Make its local
// font files available to this editor without installing them on the system.
const char *pp_register_office_fonts(void) {
    static dispatch_once_t once;
    static NSString *aliases;
    dispatch_once(&once, ^{
        NSURL *app = [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:@"com.microsoft.Powerpoint"];
        if (!app) return;
        NSURL *resources = [app URLByAppendingPathComponent:@"Contents/Resources"];
        aliases = [[resources URLByAppendingPathComponent:@"fontsGDIFamilyNames.plist"].path copy];
        NSURL *directory = [resources URLByAppendingPathComponent:@"DFonts"];
        NSArray<NSURL *> *files = [NSFileManager.defaultManager contentsOfDirectoryAtURL:directory
            includingPropertiesForKeys:nil options:NSDirectoryEnumerationSkipsHiddenFiles error:nil];
        NSMutableArray<NSURL *> *fonts = [NSMutableArray new];
        for (NSURL *file in files) {
            if ([@[@"ttf", @"otf", @"ttc", @"otc"] containsObject:file.pathExtension.lowercaseString]) {
                [fonts addObject:file];
            }
        }
        if (fonts.count) CTFontManagerRegisterFontsForURLs((__bridge CFArrayRef)fonts,
                                                          kCTFontManagerScopeProcess, NULL);
    });
    return aliases.fileSystemRepresentation;
}
