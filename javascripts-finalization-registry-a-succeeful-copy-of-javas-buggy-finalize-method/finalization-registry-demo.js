let objectOfInterest = {}

let objectOfInterestGarbageCollected = false

let finalizationRegistry = new FinalizationRegistry((goodbyeMessage) => {
    console.log(`Message from object of interest: ${goodbyeMessage}`)
    objectOfInterestGarbageCollected = true;
})

finalizationRegistry.register(objectOfInterest, "Bye, bye world!");

objectOfInterest = null;

if (typeof global !== "undefined" && global.gc) {
    console.log('Explicitly invoking the GC now...');
    global.gc();
    console.log('After invoking the GC...');

}