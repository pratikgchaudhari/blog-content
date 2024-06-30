class ObjectOfInterest {

    @Override
    protected void finalize() throws Throwable {
        System.out.println("Message from object of interest: Bye, bye world!");
    }

}

public class FinalizeDemo {
    public static void main(String[] args) {
        var finalize = new ObjectOfInterest();
        finalize = null;
        System.out.println("Explicitly invoking the GC now...");
        System.gc();
        System.out.println("After invoking the GC...");
        System.runFinalization();
    }
}