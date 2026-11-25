#import <AppKit/AppKit.h>
#import <math.h>

// Called on a background worker; AppKit presents the sampler on the main thread.
int32_t pp_sample_screen_color(void) {
    dispatch_semaphore_t finished = dispatch_semaphore_create(0);
    __block int32_t result = -1;
    dispatch_async(dispatch_get_main_queue(), ^{
        __block NSColorSampler *sampler = [[NSColorSampler alloc] init];
        [sampler showSamplerWithSelectionHandler:^(NSColor *selected) {
            NSColor *rgb = [selected colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
            if (rgb) {
                int32_t r = lround(fmin(1, fmax(0, rgb.redComponent)) * 255);
                int32_t g = lround(fmin(1, fmax(0, rgb.greenComponent)) * 255);
                int32_t b = lround(fmin(1, fmax(0, rgb.blueComponent)) * 255);
                result = (r << 16) | (g << 8) | b;
            }
            sampler = nil;
            dispatch_semaphore_signal(finished);
        }];
    });
    dispatch_semaphore_wait(finished, DISPATCH_TIME_FOREVER);
    return result;
}
