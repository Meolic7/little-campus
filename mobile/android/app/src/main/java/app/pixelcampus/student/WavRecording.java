package app.pixelcampus.student;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/** One on-disk WAV per recording; capture memory never grows with duration. */
final class WavRecording implements Closeable {
    static final int RATE=16000;
    private final RandomAccessFile file;
    private long bytes;

    WavRecording(File target) throws IOException {
        file=new RandomAccessFile(target,"rw");
        try {file.setLength(0);header(file,0);} catch(IOException error) {file.close();throw error;}
    }
    void append(byte[] data,int count) throws IOException {
        file.write(data,0,count);bytes+=count;
    }
    long samples(){return bytes/2;}
    @Override public void close() throws IOException {
        try {header(file,bytes);file.getFD().sync();} finally {file.close();}
    }
    static long recover(File target) throws IOException {
        try(RandomAccessFile file=new RandomAccessFile(target,"rw")) {
            long bytes=Math.max(0,file.length()-44)/2*2;
            file.setLength(44+bytes);header(file,bytes);file.getFD().sync();return bytes/2;
        }
    }
    private static void header(RandomAccessFile file,long bytes) throws IOException {
        ByteBuffer header=ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt((int)bytes+36)
            .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1)
            .putInt(RATE).putInt(RATE*2).putShort((short)2).putShort((short)16)
            .put("data".getBytes(StandardCharsets.US_ASCII)).putInt((int)bytes);
        file.seek(0);file.write(header.array());file.seek(44+bytes);
    }
}
