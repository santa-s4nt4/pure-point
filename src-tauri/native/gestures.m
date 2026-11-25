#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

@interface PPMagnifyMonitor : NSObject
@property(nonatomic, strong) id token;
@end
@implementation PPMagnifyMonitor
- (void)dealloc {
    if (_token) [NSEvent removeMonitor:_token];
}
@end

void pp_install_magnification(void *webview) {
    WKWebView *view = (__bridge WKWebView *)webview;
    static char key;
    if (objc_getAssociatedObject(view, &key)) return;
    __weak WKWebView *weakView = view;
    PPMagnifyMonitor *monitor = [PPMagnifyMonitor new];
    monitor.token = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMagnify
        handler:^NSEvent *(NSEvent *event) {
            WKWebView *web = weakView;
            if (!web.window || event.window != web.window || web.window.attachedSheet)
                return event;
            NSPoint point = [web convertPoint:event.locationInWindow fromView:nil];
            if (!NSPointInRect(point, web.bounds)) return event;
            double y = web.isFlipped ? point.y : NSHeight(web.bounds) - point.y;
            double factor = 1.0 + event.magnification;
            if (factor > 0 && factor != 1.0) {
                NSString *js = [NSString stringWithFormat:
                    @"window.dispatchEvent(new CustomEvent('purepoint-magnify',{detail:{factor:%.12f,x:%.5f,y:%.5f}}))",
                    factor, point.x, y];
                [web evaluateJavaScript:js completionHandler:nil];
            }
            return nil;
        }];
    objc_setAssociatedObject(view, &key, monitor, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
