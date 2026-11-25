#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>

static BOOL compatibleTrack(AVAssetTrack *track, FourCharCode codec) {
    if (!track) return YES;
    for (id format in track.formatDescriptions)
        if (CMFormatDescriptionGetMediaSubType((__bridge CMFormatDescriptionRef)format) != codec) return NO;
    return track.formatDescriptions.count > 0;
}

// Preserve H.264/AAC samples when possible. QuickTime metadata tracks from
// phones are not part of the PowerPoint movie and can prevent an MP4 export.
static BOOL exportMovie(AVAsset *asset, NSURL *url, NSString *preset, NSError **error) {
    AVAssetExportSession *exporter = [[AVAssetExportSession alloc] initWithAsset:asset presetName:preset];
    if (![exporter.supportedFileTypes containsObject:AVFileTypeMPEG4]) return NO;
    exporter.outputURL = url;
    exporter.outputFileType = AVFileTypeMPEG4;
    exporter.shouldOptimizeForNetworkUse = YES;
    dispatch_semaphore_t finished = dispatch_semaphore_create(0);
    [exporter exportAsynchronouslyWithCompletionHandler:^{ dispatch_semaphore_signal(finished); }];
    dispatch_semaphore_wait(finished, DISPATCH_TIME_FOREVER);
    if (exporter.status == AVAssetExportSessionStatusCompleted) return YES;
    *error = exporter.error;
    return NO;
}

static NSString *prepareMovie(NSURL *source, NSURL *output, NSURL *poster, double *width, double *height) {
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:source options:nil];
    AVAssetTrack *video = [asset tracksWithMediaType:AVMediaTypeVideo].firstObject;
    AVAssetTrack *audio = [asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
    if (!video) return @"macOS could not read a video track in this file.";
    CGRect bounds = CGRectApplyAffineTransform((CGRect){CGPointZero,video.naturalSize},video.preferredTransform);
    *width = fabs(bounds.size.width);
    *height = fabs(bounds.size.height);
    BOOL compatible = compatibleTrack(video,kCMVideoCodecType_H264) && compatibleTrack(audio,kAudioFormatMPEG4AAC);
    NSError *error = nil;
    if (compatible && [[source.pathExtension lowercaseString] isEqualToString:@"mp4"]) {
        if (![[NSFileManager defaultManager] copyItemAtURL:source toURL:output error:&error]) return error.localizedDescription;
    } else {
        AVMutableComposition *composition = [AVMutableComposition composition];
        for (AVAssetTrack *track in audio ? @[video,audio] : @[video]) {
            AVMutableCompositionTrack *dest = [composition addMutableTrackWithMediaType:track.mediaType preferredTrackID:kCMPersistentTrackID_Invalid];
            CMTimeRange range = CMTimeRangeGetIntersection(track.timeRange, CMTimeRangeMake(kCMTimeZero, asset.duration));
            if (![dest insertTimeRange:range ofTrack:track atTime:range.start error:&error]) return error.localizedDescription;
            if (track == video) dest.preferredTransform = video.preferredTransform;
        }
        if (!compatible || !exportMovie(composition,output,AVAssetExportPresetPassthrough,&error)) {
            [[NSFileManager defaultManager] removeItemAtURL:output error:nil];
            if (!exportMovie(composition,output,AVAssetExportPresetHighestQuality,&error))
                return error.localizedDescription ?: @"macOS could not convert this video to an MP4.";
        }
    }
    AVAssetImageGenerator *generator = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];
    generator.appliesPreferredTrackTransform = YES;
    generator.maximumSize = CGSizeMake(960,960);
    Float64 seconds = CMTimeGetSeconds(asset.duration);
    CMTime instant = CMTimeMakeWithSeconds(isfinite(seconds) ? fmin(0.25,seconds/4) : 0, 600);
    CGImageRef frame = [generator copyCGImageAtTime:instant actualTime:NULL error:&error];
    if (!frame) return error.localizedDescription ?: @"macOS could not read the first video frame.";
    NSBitmapImageRep *image = [[NSBitmapImageRep alloc] initWithCGImage:frame];
    CGImageRelease(frame);
    NSData *png = [image representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (![png writeToURL:poster options:NSDataWritingAtomic error:&error]) return error.localizedDescription ?: @"Could not save the video poster.";
    return nil;
}

char *pp_prepare_movie(const char *source, const char *output, const char *poster, double *width, double *height) {
    @autoreleasepool {
        @try {
            NSString *error = prepareMovie([NSURL fileURLWithPath:@(source)], [NSURL fileURLWithPath:@(output)], [NSURL fileURLWithPath:@(poster)], width, height);
            return error ? strdup(error.UTF8String) : NULL;
        } @catch(NSException *exception) {
            return strdup(exception.reason.UTF8String ?: "macOS could not prepare the video.");
        }
    }
}
void pp_free_movie_error(char *error) { free(error); }
