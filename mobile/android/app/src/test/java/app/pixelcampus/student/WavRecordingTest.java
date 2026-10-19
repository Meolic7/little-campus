package app.pixelcampus.student;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class WavRecordingTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();

    @Test public void savesContinuousAudioToOneFile() throws Exception {
        File target=temporary.newFile("class.wav");
        byte[] first={1,2,3,4},second={5,6,7,8};
        try(WavRecording recording=new WavRecording(target)) {
            recording.append(first,first.length);recording.append(second,second.length);
            assertEquals(4,recording.samples());
        }
        byte[] saved=Files.readAllBytes(target.toPath());
        assertEquals(52,saved.length);
        ByteBuffer header=ByteBuffer.wrap(saved).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(44,header.getInt(4));assertEquals(8,header.getInt(40));
        assertEquals(16000,header.getInt(24));
        for(int i=0;i<8;i++)assertEquals(i+1,saved[44+i]);
        assertEquals(1,temporary.getRoot().list().length);
    }
    @Test public void recoversWholeInterruptedRecordingAndDiscardsPartialSample() throws Exception {
        File target=temporary.newFile("interrupted.wav");
        try(RandomAccessFile file=new RandomAccessFile(target,"rw")) {
            file.write(new byte[44]);file.write(new byte[]{1,2,3,4,5});
        }
        assertEquals(2,WavRecording.recover(target));
        byte[] saved=Files.readAllBytes(target.toPath());
        assertEquals(48,saved.length);
        assertEquals('R',saved[0]);assertEquals(4,ByteBuffer.wrap(saved).order(ByteOrder.LITTLE_ENDIAN).getInt(40));
        assertArrayEquals(new byte[]{1,2,3,4},java.util.Arrays.copyOfRange(saved,44,48));
    }
}
