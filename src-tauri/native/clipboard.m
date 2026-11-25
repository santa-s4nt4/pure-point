#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <string.h>

static NSData *firstFramePNG(CGImageSourceRef source) {
    NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, NULL));
    NSInteger width = [properties[(__bridge NSString *)kCGImagePropertyPixelWidth] integerValue];
    NSInteger height = [properties[(__bridge NSString *)kCGImagePropertyPixelHeight] integerValue];
    if (width <= 0 || height <= 0) return nil;
    // Bake the original orientation into the PNG, including rotated HEIC photos.
    NSDictionary *options = @{
        (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
        (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
        (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @(MAX(width, height)),
    };
    CGImageRef frame = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
    if (!frame) return nil;
    NSMutableData *png = [NSMutableData data];
    CGImageDestinationRef dst = CGImageDestinationCreateWithData(
        (__bridge CFMutableDataRef)png, (__bridge CFStringRef)UTTypePNG.identifier, 1, NULL);
    BOOL success = NO;
    if (dst) {
        CGImageDestinationAddImage(dst, frame, NULL);
        success = CGImageDestinationFinalize(dst);
        CFRelease(dst);
    }
    CGImageRelease(frame);
    return success ? png : nil;
}

static NSDictionary *imageAsset(NSData *data, NSString *name) {
    if (!data.length) return nil;
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    if (!source) return nil;
    NSString *identifier = (__bridge NSString *)CGImageSourceGetType(source);
    UTType *type = identifier ? [UTType typeWithIdentifier:identifier] : nil;
    NSArray *originals = @[UTTypePNG, UTTypeJPEG, UTTypeGIF, UTTypeWebP];
    if (!type || ![originals containsObject:type]) {
        if ([type conformsToType:UTTypeTIFF] || [type conformsToType:UTTypeHEIF] ||
            [type conformsToType:UTTypeHEIC] || [type conformsToType:UTTypeBMP]) {
            data = firstFramePNG(source);
            type = UTTypePNG;
        } else {
            data = nil;
        }
    }
    CFRelease(source);
    if (!data.length) return nil;
    NSString *stem = name.stringByDeletingPathExtension ?: @"Pasted image";
    UTType *namedType = name ? [UTType typeWithFilenameExtension:name.pathExtension] : nil;
    if (![namedType isEqual:type]) name = [stem stringByAppendingPathExtension:type.preferredFilenameExtension];
    return @{@"name": name, @"mime": type.preferredMIMEType, @"data": [data base64EncodedStringWithOptions:0]};
}

static NSDictionary *fileImage(NSURL *url) {
    if (!url.isFileURL || (url.host.length && [url.host caseInsensitiveCompare:@"localhost"] != NSOrderedSame)) return nil;
    UTType *type = [UTType typeWithFilenameExtension:url.pathExtension];
    if (![type conformsToType:UTTypeImage]) return nil;
    NSNumber *regular;
    if (![url getResourceValue:&regular forKey:NSURLIsRegularFileKey error:nil] || !regular.boolValue) return nil;
    NSData *data = [NSData dataWithContentsOfURL:url options:NSDataReadingMappedIfSafe error:nil];
    return imageAsset(data, url.lastPathComponent);
}

static NSDictionary *readPasteboard(NSPasteboard *board) {
    NSMutableArray *images = [NSMutableArray array];
    // Finder also publishes display names and sometimes icon previews. Treat a
    // file selection as files even when none of them are supported images.
    if ([board.types containsObject:NSPasteboardTypeFileURL] || [board.types containsObject:NSFilenamesPboardType]) {
        NSArray *urls = [board readObjectsForClasses:@[NSURL.class] options:@{NSPasteboardURLReadingFileURLsOnlyKey: @YES}];
        if (!urls.count) {
            NSMutableArray *legacy = [NSMutableArray array];
            id paths = [board propertyListForType:NSFilenamesPboardType];
            if ([paths isKindOfClass:NSArray.class]) {
                for (id path in paths)
                    if ([path isKindOfClass:NSString.class] && [path isAbsolutePath])
                        [legacy addObject:[NSURL fileURLWithPath:path]];
            }
            urls = legacy;
        }
        for (NSURL *url in urls) {
            NSDictionary *image = fileImage(url);
            if (image) [images addObject:image];
        }
        return @{@"images": images};
    }

    NSArray *types = @[UTTypeGIF.identifier, UTTypeWebP.identifier, UTTypeJPEG.identifier,
                       NSPasteboardTypePNG, UTTypeHEIC.identifier, UTTypeHEIF.identifier,
                       NSPasteboardTypeTIFF, UTTypeBMP.identifier];
    for (NSPasteboardItem *item in board.pasteboardItems) {
        for (NSString *type in types) {
            if (![item.types containsObject:type]) continue;
            NSDictionary *image = imageAsset([item dataForType:type], nil);
            if (image) {
                [images addObject:image];
                break;
            }
        }
    }
    NSMutableDictionary *result = [@{@"images": images} mutableCopy];
    result[@"html"] = [board stringForType:NSPasteboardTypeHTML];
    result[@"text"] = [board stringForType:NSPasteboardTypeString];
    return result;
}

char *pp_read_canvas_clipboard(void) {
    @autoreleasepool {
        NSPasteboard *board = NSPasteboard.generalPasteboard;
        NSInteger change = board.changeCount;
        NSDictionary *payload = readPasteboard(board);
        if (board.changeCount != change) return NULL;
        NSData *json = [NSJSONSerialization dataWithJSONObject:payload
                                                      options:NSJSONWritingWithoutEscapingSlashes error:nil];
        return json ? strndup(json.bytes, json.length) : NULL;
    }
}
