#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CoreGraphics/CoreGraphics.h>

// Keep WebKit layout, Core Text shaping and vector painting on the same system
// stack as the editor. Process one slide per page without rasterizing the text.
@interface PPDeckPDF : NSObject <WKNavigationDelegate>
@property(nonatomic,strong) WKWebView *view;
@property(nonatomic,assign) CGContextRef output;
@property(nonatomic) NSUInteger index, count, watchdog;
@property(nonatomic) CGSize size;
@property(nonatomic,copy) void (^completion)(NSString *);
@end

@implementation PPDeckPDF
- (void)finish:(NSString *)error {
    if (!self.completion) return;
    self.watchdog++;
    if (self.output) {
        CGPDFContextClose(self.output);
        CGContextRelease(self.output);
        self.output=NULL;
    }
    self.view.navigationDelegate=nil;
    [self.view stopLoading];
    self.view=nil;
    void (^done)(NSString *)=self.completion;
    self.completion=nil;
    done(error);
}
- (void)watch {
    NSUInteger token=++self.watchdog;
    __weak PPDeckPDF *weakSelf=self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        PPDeckPDF *job=weakSelf;
        if (job && job.watchdog==token) [job finish:@"Timed out preparing a PDF page."];
    });
}
- (void)start:(NSString *)html destination:(NSURL *)url {
    CGRect page=(CGRect){.origin=CGPointZero,.size=self.size};
    self.output=CGPDFContextCreateWithURL((__bridge CFURLRef)url,&page,NULL);
    if (!self.output) { [self finish:@"Could not create the PDF file."]; return; }
    WKWebViewConfiguration *config=[WKWebViewConfiguration new];
    config.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];
    self.view=[[WKWebView alloc] initWithFrame:page configuration:config];
    self.view.navigationDelegate=self;
    [self watch];
    [self.view loadHTMLString:html baseURL:nil];
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    [self nextPage];
}
- (void)nextPage {
    if (!self.completion) return;
    if (self.index==self.count) { [self finish:nil]; return; }
    [self watch];
    // One scene is visible at the origin during capture. Its full-size view
    // works even when the user's editor window is smaller than the slide.
    NSString *script=@"const pages=document.querySelectorAll('main>section');"
        "if(!pages[index]) throw Error('Missing PDF page');"
        "if(index){const old=pages[index-1];old.hidden=true;old.replaceChildren();}"
        "const page=pages[index];page.hidden=false;void page.offsetHeight;"
        "for(const i of page.querySelectorAll('img[data-print-src]')) i.src=i.dataset.printSrc;"
        "await Promise.all([...page.querySelectorAll('img')].map(i=>i.decode().catch(()=>{})));"
        // Newly visible pages can introduce another Office font. WebKit's
        // fonts.ready may still be resolved from the previous page until paint.
        "const fonts=new Map();const walker=document.createTreeWalker(page,NodeFilter.SHOW_TEXT);"
        "while(walker.nextNode()){const node=walker.currentNode;if(!node.data.trim())continue;"
        "const s=getComputedStyle(node.parentElement),key=s.fontStyle+' '+s.fontWeight+' '+s.fontSize+' '+s.fontFamily;"
        "fonts.set(key,(fonts.get(key)||'')+node.data);}"
        "await Promise.all([...fonts].map(([key,text])=>document.fonts.load(key,text).catch(()=>{})));"
        "await document.fonts.ready;void page.offsetHeight;return true;";
    [self.view callAsyncJavaScript:script arguments:@{@"index":@(self.index)} inFrame:nil
        inContentWorld:WKContentWorld.defaultClientWorld completionHandler:^(id __unused value, NSError *error){
        (void)value;
        if (!self.completion) return;
        if (error) { [self finish:error.localizedDescription]; return; }
        WKPDFConfiguration *cfg=[WKPDFConfiguration new];
        cfg.rect=(CGRect){.origin=CGPointZero,.size=self.size};
        [self.view createPDFWithConfiguration:cfg completionHandler:^(NSData *data, NSError *failure){
            if (!self.completion) return;
            if (failure || !data) { [self finish:failure.localizedDescription ?: @"WebKit returned an empty PDF."]; return; }
            CGDataProviderRef provider=CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
            CGPDFDocumentRef doc=CGPDFDocumentCreateWithProvider(provider);
            CGPDFPageRef page=doc?CGPDFDocumentGetPage(doc,1):NULL;
            if (page) {
                CGPDFContextBeginPage(self.output,NULL);
                CGRect bounds=(CGRect){.origin=CGPointZero,.size=self.size};
                CGContextConcatCTM(self.output, CGPDFPageGetDrawingTransform(page,kCGPDFMediaBox,bounds,0,true));
                CGContextDrawPDFPage(self.output,page);
                CGPDFContextEndPage(self.output);
            }
            if (doc) CGPDFDocumentRelease(doc);
            CGDataProviderRelease(provider);
            if (!page) { [self finish:@"Could not read the rendered PDF page."]; return; }
            self.index++;
            [self nextPage];
        }];
    }];
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error { [self finish:error.localizedDescription]; }
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { [self finish:error.localizedDescription]; }
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView { [self finish:@"The PDF renderer stopped unexpectedly."]; }
@end

// Called only by Rust's blocking worker. Ownership of inputs stays with Rust
// until the main-thread renderer completes; the error is copied into its buffer.
int pp_render_pdf(const char *html, const char *path, double width, double height, size_t count, char *error, size_t capacity) {
    @autoreleasepool {
        if (NSThread.isMainThread) { snprintf(error,capacity,"The PDF renderer requires a worker thread."); return 0; }
        NSString *markup=[NSString stringWithUTF8String:html];
        NSURL *url=[NSURL fileURLWithFileSystemRepresentation:path isDirectory:NO relativeToURL:nil];
        dispatch_semaphore_t wait=dispatch_semaphore_create(0);
        __block PPDeckPDF *job;
        __block NSString *result=nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            job=[PPDeckPDF new];
            job.size=CGSizeMake(width,height); job.count=count;
            job.completion=^(NSString *reason) {
                result=[reason copy]; job=nil; dispatch_semaphore_signal(wait);
            };
            [job start:markup destination:url];
        });
        dispatch_semaphore_wait(wait,DISPATCH_TIME_FOREVER);
        if (result) { snprintf(error,capacity,"%s",result.UTF8String); return 0; }
        return 1;
    }
}
